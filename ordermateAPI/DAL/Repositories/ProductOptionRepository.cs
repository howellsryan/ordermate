using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class ProductOptionRepository : IProductOptionRepository
{
    private readonly IDbContext _dbContext;

    public ProductOptionRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }
    
    public async Task<ProductOptionModel?> Get(int productOptionId)
    {
        using var connection = _dbContext.CreateConnection();
        return await connection.QuerySingleOrDefaultAsync<ProductOptionModel?>(ProductOptionScripts.Get, new { productOptionId });
    }
    
    public async Task<IEnumerable<ProductOptionModel>> GetByProductId(int productId)
    {
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<ProductOptionModel> productOptions = await connection.QueryAsync<ProductOptionModel>(ProductOptionScripts.GetByProductId, new { productId });
        return productOptions;
    }
}