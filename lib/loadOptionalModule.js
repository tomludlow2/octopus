function loadOptionalModule(candidatePaths) {
    for (const candidatePath of candidatePaths) {
        if (!candidatePath) {
            continue;
        }

        try {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            return require(candidatePath);
        } catch (error) {
            if (error.code !== 'MODULE_NOT_FOUND') {
                throw error;
            }
        }
    }

    return null;
}

module.exports = { loadOptionalModule };
