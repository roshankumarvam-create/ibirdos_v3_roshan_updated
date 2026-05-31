import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { RecipesController } from "./recipes.controller";
import { RecipesExtractController } from "./recipes-extract.controller";
import { RecipesService } from "./recipes.service";

@Module({
  imports: [MulterModule.register({ storage: undefined })], // memory storage (buffer)
  controllers: [RecipesController, RecipesExtractController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule {}
