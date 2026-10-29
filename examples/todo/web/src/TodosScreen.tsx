import { ComposedScreen, type ScreenState, useAppStrings } from "@client-compose/react";
import { type ReactNode, useEffect } from "react";

import { AppStrings } from "./contract.generated.ts";

interface ScreenProps {
  islands: ReactNode[];
  screen: ScreenState;
}

/** The islands, under the screen's title, which is the page's title too. */
function Screen(props: ScreenProps) {
  const { islands, screen } = props;
  const title = screen.response?.meta?.title;

  useEffect(() => {
    if (title) {
      document.title = title;
    }
  }, [title]);

  return (
    <>
      <h1>{title}</h1>
      {islands}
    </>
  );
}

function layOut(islands: ReactNode[], screen: ScreenState) {
  return <Screen islands={islands} screen={screen} />;
}

/** The todos screen, as the composer makes it up. */
export function TodosScreen() {
  const strings = useAppStrings(AppStrings);

  function couldNotLoad(_error: unknown, reload: () => void) {
    return (
      <p className="status">
        {strings.couldNotLoad}{" "}
        <button type="button" onClick={reload}>
          {strings.retry}
        </button>
      </p>
    );
  }

  return (
    <ComposedScreen
      screen="todos"
      loading={<p className="status">{strings.loading}</p>}
      renderError={couldNotLoad}
    >
      {layOut}
    </ComposedScreen>
  );
}
