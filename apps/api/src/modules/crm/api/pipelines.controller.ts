import { MODULE_KEYS } from '@modubiz/contracts';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { GetPipelineBoardUseCase } from '../application/index.js';

@Controller('v1/crm/pipelines')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class PipelinesController {
  constructor(private readonly getPipelineBoardUseCase: GetPipelineBoardUseCase) {}

  @Get('default')
  @RequiresPermission('crm:deal:read')
  async getDefault() {
    return { data: await this.getPipelineBoardUseCase.execute() };
  }
}
