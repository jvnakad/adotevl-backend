import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketingList } from './entities/marketing-list.entity';
import { MarketingLabel } from './entities/marketing-label.entity';
import { MarketingCard } from './entities/marketing-card.entity';
import { MarketingCardMember } from './entities/marketing-card-member.entity';
import { MarketingCardLabel } from './entities/marketing-card-label.entity';
import { MarketingCardTask } from './entities/marketing-card-task.entity';
import { MarketingCardAttachment } from './entities/marketing-card-attachment.entity';
import { MarketingCardComment } from './entities/marketing-card-comment.entity';
import { MarketingHistoryEvent } from './entities/marketing-history-event.entity';
import { MarketingListController } from './marketing-list.controller';
import { MarketingLabelController } from './marketing-label.controller';
import { MarketingCardController } from './marketing-card.controller';
import { MarketingTaskController } from './marketing-task.controller';
import { MarketingAttachmentController } from './marketing-attachment.controller';
import { MarketingCommentController } from './marketing-comment.controller';
import { MarketingListService } from './marketing-list.service';
import { MarketingLabelService } from './marketing-label.service';
import { MarketingCardService } from './marketing-card.service';
import { MarketingTaskService } from './marketing-task.service';
import { MarketingAttachmentService } from './marketing-attachment.service';
import { MarketingCommentService } from './marketing-comment.service';
import { MarketingHistoryService } from './marketing-history.service';
import { MarketingEligibilityService } from './marketing-eligibility.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketingList,
      MarketingLabel,
      MarketingCard,
      MarketingCardMember,
      MarketingCardLabel,
      MarketingCardTask,
      MarketingCardAttachment,
      MarketingCardComment,
      MarketingHistoryEvent,
    ]),
  ],
  controllers: [MarketingListController, MarketingLabelController, MarketingCardController, MarketingTaskController, MarketingAttachmentController, MarketingCommentController],
  providers: [
    MarketingListService,
    MarketingLabelService,
    MarketingCardService,
    MarketingTaskService,
    MarketingAttachmentService,
    MarketingCommentService,
    MarketingHistoryService,
    MarketingEligibilityService,
  ],
})
export class MarketingModule {}
