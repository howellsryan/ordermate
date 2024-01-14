using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IModifierRepository
{
    Task<ModifierModel?> Get(int modifierId);
    Task<IEnumerable<ModifierModel>> Get();
    Task<IEnumerable<ModifierModel>> GetByProductOptionId(int productOptionId);
}