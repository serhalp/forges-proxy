import { defineHandler } from "nitro"
import { redirect } from "nitro/h3"

export default defineHandler(() => redirect("/docs"))
