import { notFound } from "next/navigation";

/** Always a 404: rendered by this segment's `not-found.tsx`. */
export default function SiteNotFoundPage() {
  notFound();
}
