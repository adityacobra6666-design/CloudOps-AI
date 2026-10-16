#!/bin/sh
set -e

SOURCE_CONFIG="/etc/prometheus/prometheus.yml"
GENERATED_CONFIG="/tmp/prometheus.generated.yml"

echo "INFO [prometheus-init]: Initializing Prometheus configuration..."

if [ ! -f "$SOURCE_CONFIG" ]; then
    echo "ERROR [prometheus-init]: Source configuration file not found at $SOURCE_CONFIG" >&2
    exit 1
fi

# Check if the configuration template references Grafana Cloud remote_write variables
if grep -q '\${GRAFANA_CLOUD_' "$SOURCE_CONFIG"; then
    MISSING=""
    [ -z "${GRAFANA_CLOUD_REMOTE_WRITE_URL}" ] && MISSING="${MISSING} GRAFANA_CLOUD_REMOTE_WRITE_URL"
    [ -z "${GRAFANA_CLOUD_USER}" ] && MISSING="${MISSING} GRAFANA_CLOUD_USER"
    [ -z "${GRAFANA_CLOUD_API_KEY}" ] && MISSING="${MISSING} GRAFANA_CLOUD_API_KEY"

    if [ -n "$MISSING" ]; then
        echo "ERROR [prometheus-init]: Missing required Grafana Cloud environment variable(s):${MISSING}" >&2
        echo "ERROR [prometheus-init]: Please set these variables in your root .env file before starting Prometheus." >&2
        exit 1
    fi

    case "${GRAFANA_CLOUD_REMOTE_WRITE_URL}" in
        http://*|https://*)
            ;;
        *)
            echo "ERROR [prometheus-init]: GRAFANA_CLOUD_REMOTE_WRITE_URL must start with http:// or https://" >&2
            exit 1
            ;;
    esac

    # Normalize remote_write URL: if user passed Grafana Cloud base /api/prom, append /push
    NORM_URL="${GRAFANA_CLOUD_REMOTE_WRITE_URL}"
    case "$NORM_URL" in
        */api/prom)
            NORM_URL="${NORM_URL}/push"
            ;;
        */api/prom/)
            NORM_URL="${NORM_URL}push"
            ;;
    esac

    export NORM_GRAFANA_CLOUD_REMOTE_WRITE_URL="${NORM_URL}"

    echo "INFO [prometheus-init]: Generating runtime configuration from template..."
    # Safe substitution using awk ENVIRON and literal substring replacement
    # Avoids shell interpolation, regex escaping, and sed delimiter collision
    awk '
    {
        target = "${GRAFANA_CLOUD_REMOTE_WRITE_URL}"
        while ((idx = index($0, target)) > 0) {
            $0 = substr($0, 1, idx - 1) ENVIRON["NORM_GRAFANA_CLOUD_REMOTE_WRITE_URL"] substr($0, idx + length(target))
        }
        target = "${GRAFANA_CLOUD_USER}"
        while ((idx = index($0, target)) > 0) {
            $0 = substr($0, 1, idx - 1) ENVIRON["GRAFANA_CLOUD_USER"] substr($0, idx + length(target))
        }
        target = "${GRAFANA_CLOUD_API_KEY}"
        while ((idx = index($0, target)) > 0) {
            $0 = substr($0, 1, idx - 1) ENVIRON["GRAFANA_CLOUD_API_KEY"] substr($0, idx + length(target))
        }
        print $0
    }
    ' "$SOURCE_CONFIG" > "$GENERATED_CONFIG"
else
    echo "INFO [prometheus-init]: No Grafana Cloud placeholders found. Using base configuration..."
    cat "$SOURCE_CONFIG" > "$GENERATED_CONFIG"
fi

# Restrict file permissions to container user (nobody)
chmod 600 "$GENERATED_CONFIG"

# Verify no unexpanded placeholders remain
if grep -q '\${GRAFANA_CLOUD_' "$GENERATED_CONFIG"; then
    echo "ERROR [prometheus-init]: Unresolved Grafana Cloud variables remain in generated configuration." >&2
    exit 1
fi

# Validate generated configuration using promtool
echo "INFO [prometheus-init]: Validating generated configuration with promtool..."
if ! /bin/promtool check config "$GENERATED_CONFIG"; then
    echo "ERROR [prometheus-init]: Configuration validation failed with promtool." >&2
    exit 1
fi
echo "INFO [prometheus-init]: Configuration successfully validated."

# Re-route any command-line argument that still points to /etc/prometheus/prometheus.yml
for arg do
    shift
    case "$arg" in
        --config.file=/etc/prometheus/prometheus.yml)
            set -- "$@" "--config.file=$GENERATED_CONFIG"
            ;;
        *)
            set -- "$@" "$arg"
            ;;
    esac
done

# If no arguments provided at all, use default flags
if [ $# -eq 0 ]; then
    set -- \
        --config.file="$GENERATED_CONFIG" \
        --storage.tsdb.path=/prometheus \
        --storage.tsdb.retention.time=15d
fi

echo "INFO [prometheus-init]: Starting Prometheus..."
exec /bin/prometheus "$@"
