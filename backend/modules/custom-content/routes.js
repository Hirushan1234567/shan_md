import { Router } from "express";
import { listContent, getContent } from "./controller.js";

export const handlers = Object.freeze({
  list: listContent,
  search: listContent,
  detail: getContent
});

const router = Router();
router.get("/list", listContent);
router.get("/search", listContent);
router.get("/detail", getContent);
export default router;
