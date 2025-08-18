let envConf: any[] = [];
export function setEnvConf(config: any[]) {
  envConf = config;
}

export function getEnvConf() {
  return envConf;
}
