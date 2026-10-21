import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { isLocalStorage, LOCAL_UPLOADS_DIR } from './storage/storage.service';
import { localUploadsMiddleware } from './storage/local-uploads';
import { corsOrigin } from './common/cors';

async function bootstrap() {
  // rawBody: o webhook do Autentique valida a assinatura HMAC sobre o corpo original
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Só os domínios de CORS_ORIGINS (cada ambiente tem a sua lista); sem a variável, só localhost
  app.enableCors({ origin: corsOrigin });
  // Atrás do proxy do Railway: req.ip = IP do cliente (limite de cadastros por IP)
  app.set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Em dev com STORAGE_DRIVER=local os arquivos enviados ficam em ./uploads
  if (isLocalStorage()) {
    app.use('/uploads', localUploadsMiddleware);
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
