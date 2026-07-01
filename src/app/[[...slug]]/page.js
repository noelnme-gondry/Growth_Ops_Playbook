import { resolveSlugToId, idToPath, SITE_URL } from "@/lib/routeMap";
import { findMeta } from "@/store/useDataStore";
import PageClient from "./PageClient";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const routeId = resolveSlugToId(slug);
  if (!routeId || routeId === "home") return {};

  const meta = findMeta(routeId);
  const title = meta?.title || routeId;
  const description = meta?.group?.desc;
  const canonical = `${SITE_URL}${idToPath(routeId)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default function Page({ params }) {
  return <PageClient params={params} />;
}
