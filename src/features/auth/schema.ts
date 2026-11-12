import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email is too long.")
  .pipe(z.email("Enter a valid email address."));

/** The 6-digit sign-in code. Phones sometimes paste it with a space in the middle. */
export const codeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from the email."));
