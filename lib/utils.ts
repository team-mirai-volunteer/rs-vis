import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind クラスの結合（shadcn 標準の cn） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
