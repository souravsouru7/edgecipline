import { constructNoIndexMeta } from "../../config/seo";

export const metadata = constructNoIndexMeta("Settings");

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
