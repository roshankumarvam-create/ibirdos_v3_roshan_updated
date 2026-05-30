import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CsrfController } from "./csrf.controller";

@Module({
  controllers: [AuthController, CsrfController],
  providers: [AuthService],
})
export class AuthModule {}
