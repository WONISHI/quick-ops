import type { EnvConfProps } from '../types/EnvConf';
let envConf: EnvConfProps | [] = [];
export function setEnvConf(config: EnvConfProps) {
  envConf = config;
}

export function getEnvConf(): EnvConfProps |[] {
  return envConf;
}
