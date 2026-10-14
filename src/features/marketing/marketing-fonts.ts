import { Instrument_Sans, Newsreader } from "next/font/google";

export const instrumentSans = Instrument_Sans({
  variable: "--font-marketing-sans",
  subsets: ["latin"],
  display: "swap",
});

export const newsreader = Newsreader({
  variable: "--font-marketing-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});
