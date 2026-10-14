import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { VolunteerShift } from './volunteer-shift.entity';
import { ScheduleLock } from './schedule-lock.entity';
import { User } from '../user/user.entity';
import { MailService } from '../mail/mail.service';
import {
  addDays,
  CANCEL_MIN_HOURS,
  MAX_DAYS_AHEAD,
  monthRange,
  MONTH_PATTERN,
  SCHEDULE_CLOSE,
  SCHEDULE_OPEN,
  startsAt,
  todayInBrazil,
} from './schedule-time';

/** Quem age na agenda: `canManage` = Editar em Agenda (marca/remove por qualquer um, ignora as 24h). */
export interface ScheduleActor {
  id: string;
  canManage: boolean;
}

/** Quem olha a agenda: equipe Admin vê nomes; `userId` null = LP sem identificação. */
export interface ScheduleViewer {
  userId: string | null;
  isAdmin: boolean;
}

export interface BookShiftInput {
  organizationId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  /** Marcar por outro voluntário (só quem gerencia a agenda) */
  userId?: string;
}

const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  a.startTime < b.endTime && b.startTime < a.endTime;

@Injectable()
export class VolunteerScheduleService {
  constructor(
    @InjectRepository(VolunteerShift)
    private readonly shiftRepository: Repository<VolunteerShift>,
    @InjectRepository(ScheduleLock)
    private readonly lockRepository: Repository<ScheduleLock>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
  ) {}

  /** Mês da agenda. Nomes só para a equipe Admin; o próprio voluntário se vê como "Você". */
  async month(organizationId: string, month: string, viewer: ScheduleViewer) {
    if (!MONTH_PATTERN.test(month ?? '')) throw new BadRequestException('Informe o mês no formato AAAA-MM.');
    const { from, to } = monthRange(month);
    const [shifts, locks] = await Promise.all([
      this.shiftRepository.find({
        where: { organizationId, date: Between(from, to), cancelledAt: IsNull() },
        relations: { user: true },
        order: { date: 'ASC', startTime: 'ASC' },
      }),
      this.lockRepository.find({ where: { organizationId, date: Between(from, to) }, order: { date: 'ASC' } }),
    ]);

    return {
      month,
      locks: locks.map(({ id, date, message }) => ({ id, date, message })),
      shifts: shifts.map((shift) => {
        const mine = !!viewer.userId && shift.userId === viewer.userId;
        const visible = viewer.isAdmin || mine;
        return {
          id: visible ? shift.id : null,
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          name: viewer.isAdmin ? shift.user?.fullName : mine ? 'Você' : 'Voluntário',
          mine,
          notes: visible ? (shift.notes ?? null) : null,
        };
      }),
    };
  }

  async book(input: BookShiftInput, actor: ScheduleActor, now = new Date()) {
    const userId = input.userId ?? actor.id;
    if (userId !== actor.id && !actor.canManage) throw new ForbiddenException('Você só pode marcar o seu próprio horário.');

    const user = await this.activeVolunteer(userId, input.organizationId);
    await this.validateSlot(input, userId, now);

    const saved = await this.shiftRepository.save(
      this.shiftRepository.create({
        organizationId: input.organizationId,
        userId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        notes: input.notes?.trim() || null,
        cancelToken: randomUUID(),
        createdBy: actor.id,
        updatedBy: actor.id,
      }),
    );
    await this.mailService.sendShiftConfirmationEmail(user.email, user.fullName, saved);
    return saved;
  }

  /** Troca o horário (mesmas regras de marcar + 24h para o voluntário). */
  async update(id: string, organizationId: string, input: Pick<BookShiftInput, 'startTime' | 'endTime' | 'notes'>, actor: ScheduleActor, now = new Date()) {
    const shift = await this.findActive(id, organizationId);
    this.assertCanChange(shift, actor, now);
    const next = { ...shift, ...input };
    await this.validateSlot(next, shift.userId, now, shift.id);
    await this.shiftRepository.update(id, {
      startTime: next.startTime,
      endTime: next.endTime,
      notes: next.notes?.trim() || null,
      updatedBy: actor.id,
    });
    return { ...next, notes: next.notes?.trim() || null };
  }

  async cancel(id: string, organizationId: string, actor: ScheduleActor, now = new Date()) {
    const shift = await this.findActive(id, organizationId);
    this.assertCanChange(shift, actor, now);
    const reason = shift.userId === actor.id ? 'Desmarcado pelo voluntário' : 'Removido pela equipe';
    await this.shiftRepository.update(id, { cancelledAt: now, cancelReason: reason, updatedBy: actor.id });
    return { message: 'Horário desmarcado.' };
  }

  /** Link "Desmarcar" do e-mail de confirmação. */
  async cancelByToken(cancelToken: string, now = new Date()) {
    const shift = await this.shiftRepository.findOne({ where: { cancelToken, cancelledAt: IsNull() } });
    if (!shift) throw new NotFoundException('Horário não encontrado ou já desmarcado.');
    this.assertCanChange(shift, { id: shift.userId, canManage: false }, now);
    await this.shiftRepository.update(shift.id, { cancelledAt: now, cancelReason: 'Desmarcado pelo voluntário', updatedBy: shift.userId });
    return { message: 'Horário desmarcado.', date: shift.date, startTime: shift.startTime, endTime: shift.endTime };
  }

  /** Tranca o dia: ninguém marca; quem estava marcado é desmarcado e avisado por e-mail. */
  async lock(organizationId: string, date: string, message: string, actorId: string, now = new Date()) {
    if (await this.lockRepository.findOne({ where: { organizationId, date } })) throw new ConflictException('Esse dia já está trancado.');
    const lock = await this.lockRepository.save(this.lockRepository.create({ organizationId, date, message: message.trim(), createdBy: actorId }));

    const shifts = await this.shiftRepository.find({ where: { organizationId, date, cancelledAt: IsNull() }, relations: { user: true } });
    for (const shift of shifts) {
      await this.shiftRepository.update(shift.id, { cancelledAt: now, cancelReason: `Dia trancado: ${lock.message}`, updatedBy: actorId });
      if (shift.user?.email) await this.mailService.sendShiftCancelledByLockEmail(shift.user.email, shift.user.fullName, shift, lock.message);
    }
    return { ...lock, cancelledShifts: shifts.length };
  }

  async unlock(id: string, organizationId: string) {
    const lock = await this.lockRepository.findOne({ where: { id, organizationId } });
    if (!lock) throw new NotFoundException('Dia trancado não encontrado.');
    await this.lockRepository.delete(id);
    return { message: 'Dia liberado.' };
  }

  /** Voluntários ativos da organização (select de "marcar por" de quem gerencia a agenda). */
  async volunteers(organizationId: string) {
    const users = await this.userRepository.find({
      where: { organizationId, isApproved: true, isActive: true },
      select: { id: true, fullName: true },
      order: { fullName: 'ASC' },
    });
    return users.map(({ id, fullName }) => ({ id, fullName }));
  }

  private async activeVolunteer(userId: string, organizationId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.organizationId !== organizationId || !user.isApproved || !user.isActive) {
      throw new ForbiddenException('Só voluntários ativos marcam na agenda.');
    }
    return user;
  }

  private async findActive(id: string, organizationId: string) {
    const shift = await this.shiftRepository.findOne({ where: { id, organizationId, cancelledAt: IsNull() } });
    if (!shift) throw new NotFoundException('Horário não encontrado ou já desmarcado.');
    return shift;
  }

  private assertCanChange(shift: VolunteerShift, actor: ScheduleActor, now: Date) {
    if (actor.canManage) return;
    if (shift.userId !== actor.id) throw new ForbiddenException('Você só pode alterar o seu próprio horário.');
    const hoursLeft = (startsAt(shift.date, shift.startTime).getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < CANCEL_MIN_HOURS) throw new ForbiddenException('Faltam menos de 24h para o horário. Fale com a ONG pelo WhatsApp.');
  }

  private async validateSlot(slot: { organizationId: string; date: string; startTime: string; endTime: string }, userId: string, now: Date, ignoreId?: string) {
    if (slot.startTime < SCHEDULE_OPEN || slot.endTime > SCHEDULE_CLOSE || slot.startTime > SCHEDULE_CLOSE) {
      throw new BadRequestException(`Escolha um horário entre ${SCHEDULE_OPEN} e ${SCHEDULE_CLOSE}.`);
    }
    if (slot.endTime <= slot.startTime) throw new BadRequestException('O fim precisa ser depois do início.');

    const today = todayInBrazil(now);
    if (slot.date <= today) throw new BadRequestException('Marque a partir de amanhã.');
    if (slot.date > addDays(today, MAX_DAYS_AHEAD)) throw new BadRequestException(`Dá para marcar até ${MAX_DAYS_AHEAD} dias à frente.`);

    const lock = await this.lockRepository.findOne({ where: { organizationId: slot.organizationId, date: slot.date } });
    if (lock) throw new BadRequestException(`Dia trancado: ${lock.message}`);

    const sameDay = await this.shiftRepository.find({ where: { userId, date: slot.date, cancelledAt: IsNull() } });
    if (sameDay.some((other) => other.id !== ignoreId && overlaps(other, slot))) {
      throw new ConflictException('Você já tem um horário nesse dia que cruza com este.');
    }
  }
}
