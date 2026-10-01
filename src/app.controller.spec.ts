import { AppController } from './app.controller';

describe('AppController', () => {
  it('health retorna status ok', () => {
    expect(new AppController().health()).toEqual({ status: 'ok' });
  });
});
