import type { Metadata } from "next";

// Sets the tab title; the page itself is a client component, which can't
// export metadata.
export const metadata: Metadata = {
  title: "Contributions",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
