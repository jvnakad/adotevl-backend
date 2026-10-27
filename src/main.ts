import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { isLocalStorage, LOCAL_UPLOADS_DIR } from './storage/storage.service';
import { localUploadsMiddleware } from './storage/local-uploads';
import { jwtSecret } from './auth/jwt-secret';
import { accessTokenTtl } from './auth/panel-token';

async function bootstrap() {
  // Sem JWT_SECRET forte ou com ACCESS_TOKEN_TTL inválido a API não sobe (a mensagem nunca traz o valor)
  try {
    jwtSecret();
    accessTokenTtl();
  } catch (error) {
    Logger.error((error as Error).message, 'Bootstrap');
    process.exit(1);
  }
  // rawBody: o webhook do Autentique valida a assinatura HMAC sobre o corpo original
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors();
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
