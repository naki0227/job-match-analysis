// Test stand-in for ddgs/search.py: same stdin/stdout protocol.
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const mode = request.query.split(" ").at(-1);
  if (mode === "hang") return setTimeout(() => {}, 60_000);
  if (mode === "blocked")
    return process.stdout.write(JSON.stringify({ error: "blocked" }));
  if (mode === "garbage") return process.stdout.write("not json");
  process.stdout.write(
    JSON.stringify({
      results: [
        {
          title: "env",
          // Reports which environment variables reached the subprocess.
          url: `https://search.example/?keys=${Object.keys(process.env).sort().join(",")}`,
          snippet: JSON.stringify(request),
        },
      ],
    }),
  );
});
