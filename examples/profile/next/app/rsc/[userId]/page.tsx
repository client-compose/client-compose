// React Server Components: the screen is fetched and its islands rendered on the server. Only the
// FollowButton island ships JavaScript to the browser.
import { ComposedScreen } from "@client-compose/react/server";
import Link from "next/link";

import { serverConfig } from "../../../src/composer";

const USERS = ["u_1", "u_2", "u_3"];

export default async function Page(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { userId } = await props.params;
  const viewer = (await props.searchParams).as ?? "u_1";
  return (
    <>
      <nav>
        {USERS.map((u) => (
          <Link key={u} href={`/rsc/${u}?as=${viewer}`} className={u === userId ? "active" : ""}>
            {u}
          </Link>
        ))}
      </nav>
      <ComposedScreen
        config={serverConfig(viewer)}
        screen="profile"
        params={{ userId }}
        fallback={<p className="status">Loading…</p>}
        renderError={() => (
          <p className="status">Couldn&apos;t load this profile. Is the Go composer running?</p>
        )}
      />
    </>
  );
}
