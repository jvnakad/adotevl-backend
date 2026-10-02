import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { isLocalStorage, LOCAL_UPLOADS_DIR } from './storage/storage.service';

async function bootstrap() {
  // rawBody: o webhook do Autentique valida a assinatura HMAC sobre o corpo original
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Em dev com STORAGE_DRIVER=local os arquivos enviados ficam em ./uploads
  if (isLocalStorage()) {
    app.useStaticAssets(LOCAL_UPLOADS_DIR, { prefix: '/uploads' });
  }

  const config = new DocumentBuilder()
    .setTitle('AdoteVL API')
    .setDescription('API do sistema de gestão de adoção de pets')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
