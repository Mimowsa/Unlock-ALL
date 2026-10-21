import nextEnv from "@next/env";
import { deploymentIssues } from "../src/server/deployment/config.ts";
nextEnv.loadEnvConfig(process.cwd());
const issues = deploymentIssues();
console.log(
  JSON.stringify(
    {
      configurationReady: issues.length === 0,
      issues,
      remoteConnectionsChecked: false,
      secretsLogged: false,
    },
    null,
    2,
  ),
);
if (issues.length) process.exitCode = 1;
