import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-bebas)", "'Bebas Neue'", "sans-serif"],
      },
      colors: {
        brand: {
          green: "#3d5540",
          sage: "#c8d8ca",
          light: "#f8f9f8",
        },
      },
    },
  },
  plugins: [],
};
export default config;
