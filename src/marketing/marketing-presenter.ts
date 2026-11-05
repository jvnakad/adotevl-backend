import { MarketingCardAttachment } from './entities/marketing-card-attachment.entity';
import { MarketingCardTask } from './entities/marketing-card-task.entity';
import { MarketingCardComment } from './entities/marketing-card-comment.entity';

export const isImageMime = (mimeType: string) => mimeType.startsWith('image/');

export function toAttachmentResponse(attachment: MarketingCardAttachment, urls: Record<string, string>, coverAttachmentId: string | null) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    isImage: isImageMime(attachment.mimeType),
    isCover: attachment.id === coverAttachmentId,
    // URL assinada (1 hora): pedir de novo ao reabrir o card
    url: urls[attachment.storagePath] ?? null,
    createdBy: attachment.createdBy,
    createdByName: attachment.createdByName,
    createdAt: attachment.createdAt,
  };
}

export function toTaskResponse(task: MarketingCardTask, assigneeName: string | null) {
  return {
    id: task.id,
    cardId: task.cardId,
    title: task.title,
    position: task.position,
    isDone: task.isDone,
    doneAt: task.doneAt,
    doneBy: task.doneBy,
    assignee: task.assigneeId ? { id: task.assigneeId, name: assigneeName } : null,
    dueDate: task.dueDate ?? null,
  };
}

export function toCommentResponse(comment: MarketingCardComment) {
  return {
    id: comment.id,
    cardId: comment.cardId,
    body: comment.body,
    mentions: comment.mentions ?? [],
    authorId: comment.authorId,
    authorName: comment.authorName,
    isEdited: !!comment.editedAt,
    editedAt: comment.editedAt,
    createdAt: comment.createdAt,
  };
}
