"use client";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return <Sonner className="toaster group" richColors closeButton position="bottom-right" {...props} />;
}

export { Toaster };
export { toast } from "sonner";
