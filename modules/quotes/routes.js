import { quotesController } from "./controller.js";

export async function quotesRoutes(context) {
  return quotesController(context);
}
