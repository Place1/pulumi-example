/**
 * PostgreSQL is based off [bitnami/postgresql](https://github.com/bitnami/charts/tree/master/bitnami/postgresql)
 *
 * @module "@kloudlib/postgresql"
 * @packageDocumentation
 * @example
 * ```typescript
 * import { PostgreSQL } from '@kloudlib/postgresql';
 *
 * const pg = new PostgreSQL('postgresql', {
 *   // ...
 * });
 *
 * pg.host
 * pg.port
 * pg.database
 * pg.username
 * pg.password
 * ```
 */

import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as random from '@pulumi/random';
import * as abstractions from '@kloudlib/abstractions';
import * as utils from '@kloudlib/utils';

export interface PostgreSQLInputs {
  /**
   * The pulumi kubernetes provider
   */
  provider?: k8s.Provider;
  /**
   * A kubernetes namespace. If present, this will override
   * the given provider's namespace.
   */
  namespace?: pulumi.Input<string>;
  /**
   * helm chart version
   */
  version?: string;
  /**
   * PostgreSQL admin user
   * defaults to postgres
   */
  username?: pulumi.Input<string>;
  /**
   * PostgreSQL admin user's password
   * defaults to a pulumi.RandomPassword
   */
  password?: pulumi.Input<string>;
  /**
   * PostgreSQL database name
   * defaults to postgres
   */
  database?: pulumi.Input<string>;
  /**
   * postgresql read replica configuration
   */
  replication?: PostgresqlReplication;
  /**
   * configure metrics
   */
  metrics?: PostgresqlMetrics;
  /**
   * configure persistence
   */
  persistence?: abstractions.Persistence;
  /**
   * configure resources
   */
  resources?: abstractions.ComputeResources;
}

export interface PostgresqlReplication {
  /**
   * the number of read replicas
   * defaults to 0
   */
  replicas?: pulumi.Input<number>;
  /**
   * setst the postgresql synchronous commit mode.
   * defaults to off
   */
  synchronousCommit?: pulumi.Input<'on' | 'remote_apply' | 'remote_write' | 'local' | 'off'>;
  /**
   * the number of of replicas that will have
   * synchronous replication.
   * defaults to 0
   */
  numSynchronousReplicas?: pulumi.Input<number>;
  /**
   * the postgresql password for the replication user.
   * defaults to a pulumi.RandomPassword
   */
  replicationPassword?: pulumi.Input<string>;
}

export interface PostgresqlMetrics {
  /**
   * enable a prometheus metrics exporter
   * defaults to false
   */
  enabled?: pulumi.Input<boolean>;
}

export interface PostgreSQLOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  username: pulumi.Output<string>;
  password: pulumi.Output<string>;
  database: pulumi.Output<string>;
  host: pulumi.Output<string>;
  port: pulumi.Output<string>;
  readReplicasHost: pulumi.Output<string>;
  readReplicasPort: pulumi.Output<string>;
  replicationPassword: pulumi.Output<string>;
  connectionStrings: {
    uri: pulumi.Output<string>;
    dotnet: pulumi.Output<string>;
  };
}

/**
 * @noInheritDoc
 */
export class PostgreSQL extends pulumi.ComponentResource implements PostgreSQLOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly username: pulumi.Output<string>;
  readonly password: pulumi.Output<string>;
  readonly database: pulumi.Output<string>;
  readonly host: pulumi.Output<string>;
  readonly port: pulumi.Output<string>;
  readonly readReplicasHost: pulumi.Output<string>;
  readonly readReplicasPort: pulumi.Output<string>;
  readonly replicationPassword: pulumi.Output<string>;
  readonly connectionStrings: PostgreSQLOutputs['connectionStrings'];

  constructor(name: string, props?: PostgreSQLInputs, opts?: pulumi.CustomResourceOptions) {
    super('kloudlib:PostgreSQL', name, props, opts);

    this.host = pulumi.output(`${name}-postgresql`);
    this.port = pulumi.output('5432');
    this.database = pulumi.output(props?.database ?? 'postgres');
    this.username = pulumi.output(props?.username ?? 'postgres');
    this.password = pulumi.secret(
      props?.password ??
        new random.RandomPassword(
          `${name}-postgresql-password`,
          {
            length: 32,
            special: false,
          },
          { parent: this }
        ).result
    );

    this.readReplicasHost = pulumi.output(`${name}-postgresql-read`);
    this.readReplicasPort = pulumi.output('5432');
    this.replicationPassword = pulumi.secret(
      props?.replication?.replicationPassword ??
        new random.RandomPassword(
          `${name}-postgresql-replication-password`,
          {
            length: 32,
            special: false,
          },
          { parent: this }
        ).result
    );

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'postgresql',
      version: props?.version ?? '8.6.13',
      repo: 'https://charts.bitnami.com/bitnami',
    });

    new k8s.helm.v3.Chart(
      name,
      {
        namespace: props?.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        fetchOpts: {
          repo: this.meta.repo,
        },
        transformations: [
          utils.replaceApiVersion('StatefulSet', 'apps/v1beta2', 'apps/v1'),
          (obj) => {
            // If there are no replicas the helm chart will still create the
            // postgres-read service and pulumi will await pods behind it.
            // Given there are no replicas we need to tell pulumi to skip waiting.
            if (!props?.replication?.replicas) {
              if (obj.kind === 'Service' && obj.metadata.name === `${name}-postgresql-read`) {
                if (!obj.metadata.annotations) {
                  obj.metadata.annotations = {};
                }
                obj.metadata.annotations['pulumi.com/skipAwait'] = 'true';
              }
            }
          },
        ],
        values: {
          global: {
            postgresql: {
              postgresqlUsername: this.username,
              postgresqlPassword: this.password,
              postgresqlDatabase: this.database,
              replicationPassword: this.replicationPassword,
            },
          },
          replication: {
            // Replication is always enabled.
            // The bitnami/postgresql chart deployes a completely
            // different statefulset + pvc for the master instance
            // when replication is on or off.
            // This behaviour makes the chart dangerous to use because
            // simply "enabling replication" essentially deletes your
            // current single master db instance.
            // To resolve this usability issue we'll leave replication
            // enabled but default the number of read replicas to 0.
            // This configuration means it's safe for a user to start
            // their deployment without read replicas (single instance)
            // and then later increase the number of read replicas without
            // downtime.
            enabled: true,
            user: 'repl_user',
            password: this.replicationPassword,
            slaveReplicas: props?.replication?.replicas ?? 0,
            synchronousCommit: props?.replication?.synchronousCommit ?? 'off',
            numSynchronousReplicas: props?.replication?.numSynchronousReplicas ?? 0,
          },
          metrics: {
            enabled: props?.metrics?.enabled,
          },
          persistence: {
            enabled: props?.persistence?.enabled,
            size: props?.persistence && pulumi.interpolate`${props?.persistence.sizeGB}Gi`,
            storageClass: props?.persistence?.storageClass,
          },
          resources: props?.resources,
        },
      },
      {
        parent: this,
        provider: props?.provider,
      }
    );

    this.connectionStrings = {
      uri: pulumi.interpolate`postgresql://${this.username}:${this.password}@${this.host}:${this.port}/${this.database}?sslmode=disable`,
      dotnet: pulumi.interpolate`Host=${this.host};Port=${this.port};Database=${this.database};Username=${this.username};Password=${this.password};SSL Mode=Disable`,
    };
  }
}
