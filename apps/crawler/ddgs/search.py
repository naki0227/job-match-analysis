"""DuckDuckGo-only web search for job discovery (ADR-047).

Reads one JSON request on stdin and writes one JSON response on stdout:
  request:  {"query": str, "maxResults": int, "region": str, "timeoutSeconds": int}
  response: {"results": [{"title", "url", "snippet"}]} or {"error": kind}

DDGS silently falls back to every engine ("auto") when the requested backend
is unknown, so this script refuses to search unless the "duckduckgo" text
engine exists; queries never go to another search engine.
"""

import json
import sys

DDGS_VERSION = "9.16.0"


def respond(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def duckduckgo_available() -> bool:
    import ddgs
    from ddgs.engines import ENGINES

    return ddgs.__version__ == DDGS_VERSION and "duckduckgo" in ENGINES.get("text", {})


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        ok = duckduckgo_available()
        respond({"ok": ok, "version": DDGS_VERSION})
        return 0 if ok else 1
    try:
        request = json.load(sys.stdin)
        query = str(request["query"])
        max_results = int(request["maxResults"])
        region = str(request["region"])
        timeout = int(request["timeoutSeconds"])
    except (ValueError, KeyError, TypeError):
        respond({"error": "invalid_request"})
        return 2
    if not query or len(query) > 300 or not 1 <= max_results <= 25 or not 1 <= timeout <= 30:
        respond({"error": "invalid_request"})
        return 2
    if not duckduckgo_available():
        respond({"error": "unavailable"})
        return 0

    from ddgs import DDGS
    from ddgs.exceptions import DDGSException, RatelimitException, TimeoutException

    try:
        results = DDGS(timeout=timeout).text(
            query,
            backend="duckduckgo",
            region=region,
            safesearch="moderate",
            max_results=max_results,
        )
    except RatelimitException:
        respond({"error": "blocked"})
        return 0
    except TimeoutException:
        respond({"error": "timeout"})
        return 0
    except DDGSException:
        # DDGS also raises "No results found" when DuckDuckGo answers with its
        # bot challenge (HTTP 202 "anomaly"), which it does after the first
        # query from a busy address. That is not an empty result: reporting
        # it as one made a discovery "complete" with nothing and cached it.
        # A company search that truly has no results is retried and then
        # fails the same way, which is safe.
        respond({"error": "unavailable"})
        return 0
    respond(
        {
            "results": [
                {
                    "title": str(item.get("title", ""))[:300],
                    "url": str(item.get("href", ""))[:2048],
                    "snippet": str(item.get("body", ""))[:500],
                }
                for item in results[:max_results]
            ]
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
