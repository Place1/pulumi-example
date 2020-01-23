export function removeHelmTests() {
  return (obj: any) => {
    if (!obj) {
      return;
    }
    if (obj.metadata && obj.metadata.annotations && obj.metadata.annotations['helm.sh/hook']) {
      // transforms in nodejs expects you to mutate input object, not return a new one.
      // https://github.com/pulumi/pulumi-kubernetes/blob/4b01b5114df3045cecefd2ff3e2f2ed64430e3dd/sdk/nodejs/yaml/yaml.ts#L2214
      for (const key in obj) {
        delete obj[key]
      }
      Object.assign(obj, {
        kind: "List",
        apiVersion: "v1",
        metadata: {},
        items: [],
      });
      return;
    }
    return;
  }
}