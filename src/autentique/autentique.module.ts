import { Module, Global } from '@nestjs/common';
import { AutentiqueService } from './autentique.service';

@Global()
@Module({
  providers: [AutentiqueService],
  exports: [AutentiqueService],
})
export class AutentiqueModule {}
