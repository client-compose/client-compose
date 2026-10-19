// Classic server rendering with client-side data fetching: fetch on the server with loadScreen, then
// hand the response to the client <ComposedScreen> as initialResponse.
import { loadScreen } from "@client-compose/react";
import { serverConfig } from "../../../src/composer";
import { ClientProfile } from "../../../src/client-profile";

export default async function Page(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { userId } = await props.params;
  const viewer = (await props.searchParams).as ?? "u_1";
  const initialResponse = await loadScreen(serverConfig(viewer), "profile", { userId });
  return <ClientProfile viewer={viewer} userId={userId} initialResponse={initialResponse} />;
}
