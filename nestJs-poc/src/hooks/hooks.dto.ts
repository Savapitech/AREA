import { IsObject, IsString, MinLength } from 'class-validator';

export class WebhookDto {
  @IsString()
  @MinLength(1)
  eventId: string;

  @IsString()
  eventType: string;

  @IsObject()
  payload: Record<string, unknown>;
}
