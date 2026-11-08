import { listMovies, getMovie } from "./movies/controller.js";

// Register each module's supported action handlers here.
export const moduleRegistry = Object.freeze({
  movies: Object.freeze({
    list: listMovies,
    search: listMovies,
    detail: getMovie
  })
});
