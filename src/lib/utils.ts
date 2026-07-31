import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Helper padrão do shadcn/ui para compor classes Tailwind.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
