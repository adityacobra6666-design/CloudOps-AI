const aiProvider = require("./ai");

const analyzeIncident = async (incident) => {
    return await aiProvider.analyzeIncident(incident);
};

module.exports = {
    analyzeIncident
};