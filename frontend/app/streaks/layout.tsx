import { constructNoIndexMeta } from "../../config/seo";

export const metadata = constructNoIndexMeta("Discipline Streak");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
