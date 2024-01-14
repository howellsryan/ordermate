using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;

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
        var query = "SELECT * FROM Modifiers WHERE ModifierId = @modifierId";
        using var connection = _dbContext.CreateConnection();
        
        ModifierModel? modifier = await connection.QuerySingleOrDefaultAsync<ModifierModel>(query, new { modifierId });
        return modifier;
    }

    public async Task<IEnumerable<ModifierModel>> Get()
    {
        var query = "SELECT * FROM Modifiers";
        using var connection = _dbContext.CreateConnection();

        return await connection.QueryAsync<ModifierModel>(query);
    }

    public async Task<IEnumerable<ModifierModel>> GetByProductOptionId(int productOptionId)
    {
        var query = "SELECT m.ModifierId, m.Name, m.Price, m.Quantity, m.CreatedDate, m.LastModifiedDate FROM productoptions po INNER JOIN ProductOptionModifiers pom ON po.ProductOptionId = pom.ProductOptionId INNER JOIN Modifiers m ON pom.ModifierId = m.ModifierId WHERE po.ProductOptionId = @productOptionId";
        using var connection = _dbContext.CreateConnection();

        return await connection.QueryAsync<ModifierModel>(query, new { productOptionId });
    }
}