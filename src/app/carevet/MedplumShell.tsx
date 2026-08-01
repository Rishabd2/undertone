"use client";

import { useEffect, useMemo, useState } from "react";
import { MedplumClient } from "@medplum/core";
import { MedplumProvider } from "@medplum/react";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "@medplum/react/styles.css";
import { CareVetDemo, type DemoSession } from "./CareVetDemo";

const theme = createTheme({
  primaryColor: "blue",
  fontFamily:
    "Schibsted Grotesk, Avenir Next, -apple-system, system-ui, sans-serif",
  headings: {
    fontFamily: "Fraunces, Georgia, serif",
  },
});

export function MedplumShell() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setSession(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const medplum = useMemo(() => {
    if (!session) return null;
    const client = new MedplumClient({ baseUrl: session.baseUrl });
    client.setAccessToken(session.accessToken);
    return client;
  }, [session]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F5F6F8] p-6 text-[#1A2332]">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!session || !medplum) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F5F6F8] text-sm text-[#5C6B7A]">
        Connecting to Medplum…
      </div>
    );
  }

  return (
    <MedplumProvider medplum={medplum}>
      <MantineProvider theme={theme}>
        <CareVetDemo session={session} />
      </MantineProvider>
    </MedplumProvider>
  );
}
