import { Router } from "express";
import { listMovies, getMovie } from "./controller.js";

const router = Router();
router.get("/list", listMovies);
router.get("/search", listMovies);
router.get("/detail", getMovie);
export default router;
