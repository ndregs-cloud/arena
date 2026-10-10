import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      ".data/**",
      "node_modules/**",
      "**/*.pdf",
      // Deklarasi tipe hasil generate (bukan sumber yang perlu dilint).
      "scripts/**/*.d.mts",
    ],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      // Blueprint §10.4: validasi di boundary, bukan di komponen UI.
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='fetch'] Argument > Literal[value=/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)/]",
          message: "Jangan memanggil localhost dari kode yang berjalan di browser.",
        },
        {
          selector:
            "Literal[value=/\\b(sk_|secret|password|api[_-]?key)\\b.{0,40}\\b[a-zA-Z0-9]{20,}\\b/i]",
          message: "Sepertinya ada kredensial literal di source. Pindahkan ke environment secret.",
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
];

/** @type {import("eslint").Linter.Config[]} */
export default config;
