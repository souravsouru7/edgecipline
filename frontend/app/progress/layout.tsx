import { constructNoIndexMeta } from "../../config/seo";

export const metadata = constructNoIndexMeta("Mind Score");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
