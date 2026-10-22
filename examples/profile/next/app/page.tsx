import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1>Client Compose with Next.js</h1>
      <ul>
        <li>
          <Link href="/rsc/u_2">React Server Components</Link>:{" "}
          <code>@client-compose/react/server</code>
        </li>
        <li>
          <Link href="/ssr/u_2">Server-rendered, client-fetched</Link>: <code>loadScreen</code> +{" "}
          <code>initialResponse</code>
        </li>
      </ul>
    </>
  );
}
