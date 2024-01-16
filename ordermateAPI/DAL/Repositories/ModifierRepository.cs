using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class ModifierRepository : IModifierRepository
{
    private readonly IDbContext _dbContext;

    public ModifierRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }
    
    public async Task<ModifierModel?> Get(int modifierId)
    {
        using var connection = _dbContext.CreateConnection();
        
        ModifierModel? modifier = await connection.QuerySingleOrDefaultAsync<ModifierModel>(ModifierScripts.GetByModifierId, new { modifierId });
        return modifier;
    }

    public async Task<IEnumerable<ModifierModel>> Get()
    {
        using var connection = _dbContext.CreateConnection();

        return await connection.QueryAsync<ModifierModel>(ModifierScripts.Get);
    }

    public async Task<IEnumerable<ModifierModel>> GetByProductOptionId(int productOptionId)
    {
        using var connection = _dbContext.CreateConnection();

        return await connection.QueryAsync<ModifierModel>(ModifierScripts.GetByProductOptionId, new { productOptionId });
    }
}