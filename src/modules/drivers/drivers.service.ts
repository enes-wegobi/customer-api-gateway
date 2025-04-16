import { Injectable, Logger } from '@nestjs/common';
import { DriversClient } from 'src/clients/driver/drivers.client';
import { FileType } from './enum/file-type.enum';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(private readonly driversClient: DriversClient) {}

  async findOne(id: string) {
    return this.driversClient.findOne(id);
  }

  async checkFileExists(
    driverId: string,
    fileType: FileType,
  ): Promise<boolean> {
    return this.driversClient.checkFileExists(driverId, fileType);
  }

  async deleteFile(driverId: string, fileType: FileType): Promise<any> {
    return this.driversClient.deleteFile(driverId, fileType);
  }

  async notifyFileUploaded(
    driverId: string,
    fileType: FileType,
    fileKey: string,
    contentType: string,
  ): Promise<any> {
    return this.driversClient.notifyFileUploaded(
      driverId,
      fileType,
      fileKey,
      contentType,
    );
  }
}
