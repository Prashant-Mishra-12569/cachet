# Concordium Credential Verification Service for Railway.
# The official image has no shell (distroless), and Railway gives secrets as variables, not files.
# A static busybox decodes the key from VERIFIER_KEY_B64 into a private temp file, then starts the
# unchanged service. The key is never part of this image.
FROM busybox:1.37.0-musl AS busybox

FROM concordium/credential-verification-service:0.3.1
COPY --from=busybox /bin/busybox /busybox
ENV CREDENTIAL_VERIFICATION_SERVICE_ACCOUNT=/tmp/account.export \
    CREDENTIAL_VERIFICATION_SERVICE_API_ADDRESS=[::]:8000 \
    CREDENTIAL_VERIFICATION_SERVICE_MONITORING_ADDRESS=[::]:8001 \
    CREDENTIAL_VERIFICATION_SERVICE_LOG_LEVEL=info
EXPOSE 8000 8001
ENTRYPOINT ["/busybox", "sh", "-c", "umask 077 && printf '%s' \"$VERIFIER_KEY_B64\" | /busybox base64 -d > /tmp/account.export && exec credential-verification-service"]
