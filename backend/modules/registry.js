import { handlers as movieHandlers } from "./movies/routes.js";

// Register each module's supported action handlers here.
export const moduleRegistry = Object.freeze({
  movies: movieHandlers
});
