import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { Profile } from '../profile/profile.entity';
import { Organization } from '../organization/organization.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Profile, Organization])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
