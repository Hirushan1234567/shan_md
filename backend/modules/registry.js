import { handlers as movieHandlers } from "./movies/routes.js";
import { handlers as customContentHandlers } from "./custom-content/routes.js";

// Register each module's supported action handlers here.
export { customContentHandlers };

export const moduleRegistry = Object.freeze({
  movies: movieHandlers
});
