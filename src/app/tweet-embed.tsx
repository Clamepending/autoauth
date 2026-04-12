"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: Element | null) => void;
      };
    };
  }
}

type TweetEmbedProps = {
  html: string;
};

export function TweetEmbed({ html }: TweetEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  function loadWidget() {
    if (containerRef.current && window.twttr?.widgets) {
      window.twttr.widgets.load(containerRef.current);
    }
  }

  useEffect(() => {
    loadWidget();
  }, [html]);

  return (
    <>
      <Script
        id="ottoauth-twitter-widgets"
        src="https://platform.twitter.com/widgets.js"
        strategy="afterInteractive"
        onReady={loadWidget}
      />
      <div
        ref={containerRef}
        className="tweet-embed-shell"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
